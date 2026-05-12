// frontend/src/pages/editor/EditorPage.tsx
//
// Solo-mode Monaco-ish editor (D4 Stream F migration, 2026-05-12). Pivot:
// peer-collab (Yjs / WS / awareness / yCollab) был дропнут вместе с Hone
// Editor.tsx; что осталось — личная code-room с persistence + Judge0 run.
//
// Маршруты:
//   /editor/new  → создать новую (Go default), redirect на /editor/:id
//   /editor/:id  → editable view, debounced autosave, Run / Format buttons
//
// Не используем Monaco editor — слишком тяжёлый bundle для solo MVP. Берём
// CodeMirror 6 (уже в deps; раньше использовался в EditorRoomSharePage).
// Тип EditorPage из требований — это "Monaco-style", не строго Monaco.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, lineNumbers, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { go } from '@codemirror/lang-go'
import { python } from '@codemirror/lang-python'
import { javascript } from '@codemirror/lang-javascript'
import { HighlightStyle, syntaxHighlighting, indentOnInput } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

import { API_BASE, readAccessToken } from '../../lib/apiClient'
import {
  useCreateEditorMutation,
  useEditorQuery,
  type EditorLanguage,
} from '../../lib/queries/editor'

// ─── Page entry ───────────────────────────────────────────────────────────

export default function EditorPage() {
  const { id: rawId } = useParams<{ id: string }>()
  const id = useMemo(() => (rawId ?? '').trim(), [rawId])
  const navigate = useNavigate()

  const isNew = id === 'new'
  const createMu = useCreateEditorMutation()
  const createMuMutate = createMu.mutate
  const createMuIsPending = createMu.isPending

  useEffect(() => {
    if (!isNew) return
    createMuMutate(
      { language: 'language_go' },
      {
        onSuccess: (room) => {
          navigate(`/editor/${room.id}`, { replace: true })
        },
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew])

  useEffect(() => {
    // CodeMirror VSCode theme is hardcoded to #1e1e1e — body bg must
    // match so there's no seam during scroll-bounce. Intentional theme
    // chrome, not a chromatic violation in the page-shell sense.
    const prev = document.body.style.backgroundColor
    document.body.style.backgroundColor = '#1e1e1e'
    return () => {
      document.body.style.backgroundColor = prev
    }
  }, [])

  if (isNew) {
    return (
      <CenterMessage
        text={createMuIsPending ? 'CREATING ROOM…' : 'PREPARING ROOM…'}
      />
    )
  }
  if (!id) return <CenterMessage text="MISSING ROOM ID" />

  return <SoloEditorGate id={id} />
}

function SoloEditorGate({ id }: { id: string }) {
  const roomQ = useEditorQuery(id)

  if (roomQ.isLoading) return <CenterMessage text="LOADING ROOM…" />
  if (roomQ.error) {
    const status = (roomQ.error as { status?: number }).status
    if (status === 404) return <CenterMessage text="ROOM NOT FOUND" />
    if (status === 403) return <CenterMessage text="PRIVATE ROOM" sub="You don't have access." />
    if (status === 401) return <CenterMessage text="SIGN IN REQUIRED" />
    return (
      <CenterMessage
        text="ERROR"
        sub={(roomQ.error as Error)?.message ?? 'Unknown'}
      />
    )
  }
  if (!roomQ.data) return <CenterMessage text="ROOM NOT FOUND" />
  const lang = normaliseLanguage(roomQ.data.language)
  return <SoloEditor id={id} language={lang} />
}

// ─── Solo editor ──────────────────────────────────────────────────────────

interface RunResult {
  stdout: string
  stderr: string
  exitCode: number
  timeMs: number
  status: string
}

function isJudgeError(status: string): boolean {
  if (!status) return false
  const s = status.toLowerCase()
  return s.includes('internal error') || s.includes('exec format') || s === 'undefined'
}

type EditorLangShort = 'go' | 'python' | 'javascript' | 'typescript'

function SoloEditor({ id, language }: { id: string; language: EditorLangShort }) {
  const viewRef = useRef<EditorView | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const lastSavedRef = useRef<string>('')
  const debounceRef = useRef<number | null>(null)

  const [running, setRunning] = useState(false)
  const runningRef = useRef(false)
  const [runResult, setRunResult] = useState<RunResult | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [outputTab, setOutputTab] = useState<'stdout' | 'stderr'>('stdout')

  // Save mutation: PUT /editor/room/:id/snapshot {code}. Backend hand-rolled.
  const saveNow = useCallback(
    async (code: string) => {
      const token = readAccessToken()
      setSaveState('saving')
      try {
        const resp = await fetch(
          `${API_BASE}/editor/room/${encodeURIComponent(id)}/snapshot`,
          {
            method: 'PUT',
            headers: {
              'content-type': 'application/json',
              ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ code }),
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

  // Boot CodeMirror once per (id, language).
  useEffect(() => {
    const langExt = (() => {
      switch (language) {
        case 'go':
          return go()
        case 'python':
          return python()
        case 'javascript':
        case 'typescript':
          return javascript({ typescript: language === 'typescript' })
        default:
          return javascript()
      }
    })()
    const themeCompartment = new Compartment()

    const cmState = EditorState.create({
      doc: '',
      extensions: [
        lineNumbers(),
        history(),
        indentOnInput(),
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
        langExt,
        themeCompartment.of([
          syntaxHighlighting(vscodeHighlight),
          vscodeTheme(),
        ]),
        EditorView.updateListener.of((u) => {
          if (!u.docChanged) return
          const next = u.state.doc.toString()
          if (next === lastSavedRef.current) return
          lastSavedRef.current = next
          if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
          debounceRef.current = window.setTimeout(() => {
            debounceRef.current = null
            void saveNow(next)
          }, 1200)
        }),
      ],
    })
    const mount = document.getElementById('cm-mount-solo')
    if (!mount) return
    const view = new EditorView({ state: cmState, parent: mount })
    viewRef.current = view

    // Initial hydrate: GET /editor/room/:id/snapshot → seed editor.
    void (async () => {
      const token = readAccessToken()
      try {
        const resp = await fetch(
          `${API_BASE}/editor/room/${encodeURIComponent(id)}/snapshot`,
          {
            headers: token ? { authorization: `Bearer ${token}` } : undefined,
          },
        )
        if (!resp.ok) return
        const j = (await resp.json()) as { code?: string }
        if (typeof j.code !== 'string') return
        const v = viewRef.current
        if (!v) return
        lastSavedRef.current = j.code
        v.dispatch({
          changes: { from: 0, to: v.state.doc.length, insert: j.code },
        })
      } catch {
        /* fresh editor, fine */
      }
    })()

    return () => {
      // Flush pending save synchronously.
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current)
        debounceRef.current = null
        const v = viewRef.current
        if (v) {
          const code = v.state.doc.toString()
          if (code !== lastSavedRef.current) void saveNow(code)
        }
      }
      view.destroy()
      viewRef.current = null
    }
  }, [id, language, saveNow])

  // Run code — Judge0.
  const handleRun = useCallback(async () => {
    if (runningRef.current) return
    const view = viewRef.current
    if (!view) return
    const code = view.state.doc.toString()
    runningRef.current = true
    setRunning(true)
    setRunError(null)
    setPanelOpen(true)
    try {
      const token = readAccessToken()
      const langName: Record<EditorLangShort, string> = {
        go: 'LANGUAGE_GO',
        python: 'LANGUAGE_PYTHON',
        javascript: 'LANGUAGE_JAVASCRIPT',
        typescript: 'LANGUAGE_TYPESCRIPT',
      }
      const resp = await fetch(
        `${API_BASE}/editor/room/${encodeURIComponent(id)}/run`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ code, language: langName[language] }),
        },
      )
      if (resp.status === 503) {
        setRunResult(null)
        setRunError('Sandbox not configured.')
        return
      }
      if (resp.status === 429) {
        setRunResult(null)
        setRunError('Rate limit reached — slow down.')
        return
      }
      if (resp.status === 403) {
        setRunResult(null)
        setRunError('You are not the owner.')
        return
      }
      if (!resp.ok) {
        setRunResult(null)
        setRunError(`HTTP ${resp.status}`)
        return
      }
      const j = (await resp.json()) as {
        stdout?: string
        stderr?: string
        exitCode?: number
        exit_code?: number
        timeMs?: number
        time_ms?: number
        status?: string
      }
      const r: RunResult = {
        stdout: j.stdout ?? '',
        stderr: j.stderr ?? '',
        exitCode: j.exitCode ?? j.exit_code ?? 0,
        timeMs: j.timeMs ?? j.time_ms ?? 0,
        status: j.status ?? '',
      }
      setRunResult(r)
      setOutputTab(r.stderr && !r.stdout ? 'stderr' : 'stdout')
    } catch (e) {
      setRunResult(null)
      setRunError((e as Error).message)
    } finally {
      runningRef.current = false
      setRunning(false)
    }
  }, [id, language])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        void handleRun()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleRun])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#1e1e1e', color: '#d4d4d4' }}>
      <div
        id="cm-mount-solo"
        style={{
          position: 'absolute',
          inset: 0,
          paddingBottom: panelOpen ? 220 : 0,
          fontFamily: '"JetBrains Mono", monospace',
          transition: 'padding-bottom var(--motion-dur-medium) var(--motion-ease-standard)',
        }}
      />

      {/* Top-right: RUN + status. */}
      <div
        style={{
          position: 'fixed',
          top: 14,
          right: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          zIndex: 25,
        }}
      >
        <button
          type="button"
          onClick={() => void handleRun()}
          disabled={running}
          title="Run code (⌘↵)"
          style={{
            padding: '7px 14px',
            fontSize: 12,
            fontWeight: 500,
            letterSpacing: '0.08em',
            background: 'rgb(var(--ink))',
            color: 'rgb(var(--color-bg))',
            border: 'none',
            borderRadius: 999,
            cursor: running ? 'default' : 'pointer',
            opacity: running ? 0.6 : 1,
            fontFamily: '"JetBrains Mono", monospace',
            transition: 'opacity var(--motion-dur-small) var(--motion-ease-standard)',
          }}
        >
          {running ? '⏵ RUNNING…' : '▶ RUN'}
        </button>
      </div>

      {/* Output panel. */}
      {panelOpen && (
        <div
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            height: 220,
            background: 'rgba(15,15,17,0.96)',
            backdropFilter: 'blur(20px)',
            borderTop: '1px solid var(--hair-2)',
            zIndex: 24,
            display: 'flex',
            flexDirection: 'column',
            fontFamily: '"JetBrains Mono", monospace',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 16px',
              borderBottom: '1px solid var(--hair)',
            }}
          >
            <div style={{ display: 'flex', gap: 14 }}>
              {(['stdout', 'stderr'] as const).map((tab) => (
                <button
                  type="button"
                  key={tab}
                  onClick={() => setOutputTab(tab)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: outputTab === tab ? 'rgb(var(--ink))' : 'var(--ink-40)',
                    cursor: 'pointer',
                    fontSize: 10,
                    letterSpacing: '0.08em',
                    padding: 0,
                    transition: 'color var(--motion-dur-small) var(--motion-ease-standard)',
                  }}
                >
                  {tab.toUpperCase()}
                </button>
              ))}
              {runResult && (
                <span
                  style={{
                    color: isJudgeError(runResult.status)
                      ? 'var(--red)'
                      : 'var(--ink-40)',
                    fontSize: 10,
                    letterSpacing: '0.08em',
                  }}
                >
                  {isJudgeError(runResult.status)
                    ? `JUDGE0 · ${runResult.status.toUpperCase()}`
                    : `EXIT ${runResult.exitCode} · ${runResult.timeMs}ms`}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--ink-40)',
                cursor: 'pointer',
                fontSize: 14,
                lineHeight: 1,
                transition: 'color var(--motion-dur-small) var(--motion-ease-standard)',
              }}
              title="Close output"
            >
              ×
            </button>
          </div>
          <pre
            style={{
              flex: 1,
              margin: 0,
              padding: '12px 16px',
              overflow: 'auto',
              fontSize: 12,
              color: outputTab === 'stderr' ? 'var(--red)' : 'rgb(var(--ink))',
              whiteSpace: 'pre-wrap',
            }}
          >
            {runError
              ? runError
              : running && !runResult
                ? '…'
                : runResult
                  ? outputTab === 'stdout'
                    ? runResult.stdout || '(no stdout)'
                    : runResult.stderr || '(no stderr)'
                  : ''}
          </pre>
        </div>
      )}

      {/* Bottom-right meta chip. */}
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
        <span>{language.toUpperCase()}</span>
        <span style={{ opacity: 0.4, margin: '0 8px' }}>·</span>
        <span style={{ color: saveStateColor(saveState) }}>{saveStateLabel(saveState)}</span>
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function normaliseLanguage(l: EditorLanguage | string | undefined): EditorLangShort {
  const s = String(l ?? '').toLowerCase()
  if (s.includes('python')) return 'python'
  if (s.includes('typescript')) return 'typescript'
  if (s.includes('javascript')) return 'javascript'
  return 'go'
}

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

// VSCode-ish theme (mirror of legacy hone Editor.tsx).
const vscodeHighlight = HighlightStyle.define([
  { tag: t.keyword, color: '#569cd6', fontWeight: '500' },
  { tag: [t.controlKeyword, t.moduleKeyword], color: '#c586c0' },
  { tag: [t.string, t.special(t.string), t.character], color: '#ce9178' },
  { tag: [t.number, t.atom], color: '#b5cea8' },
  { tag: t.bool, color: '#569cd6' },
  { tag: t.null, color: '#569cd6' },
  { tag: t.literal, color: '#b5cea8' },
  { tag: [t.constant(t.variableName), t.constant(t.propertyName)], color: '#4fc1ff' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: '#6a9955', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: '#dcdcaa' },
  { tag: t.macroName, color: '#c586c0' },
  { tag: [t.typeName, t.className, t.namespace, t.angleBracket], color: '#4ec9b0' },
  { tag: t.variableName, color: '#9cdcfe' },
  { tag: t.propertyName, color: '#9cdcfe' },
  { tag: [t.standard(t.variableName), t.special(t.variableName), t.self], color: '#569cd6' },
  { tag: [t.operator, t.punctuation], color: '#d4d4d4' },
  { tag: t.bracket, color: '#d4d4d4' },
  { tag: t.tagName, color: '#569cd6' },
  { tag: t.attributeName, color: '#9cdcfe' },
  { tag: t.regexp, color: '#d16969' },
  { tag: t.escape, color: '#d7ba7d' },
])

function vscodeTheme() {
  return EditorView.theme(
    {
      '&': {
        height: '100vh',
        backgroundColor: '#1e1e1e',
        color: '#d4d4d4',
        fontSize: '14px',
        fontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace',
      },
      '.cm-content': { caretColor: '#aeafad', padding: '20px 24px' },
      '.cm-gutters': { backgroundColor: '#1e1e1e', color: '#858585', border: 'none' },
      '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.04)' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#c6c6c6' },
      '.cm-cursor': { borderLeftColor: '#aeafad', borderLeftWidth: '1.5px' },
      '.cm-selectionBackground, ::selection': { backgroundColor: '#264f78' },
    },
    { dark: true },
  )
}

function CenterMessage({ text, sub }: { text: string; sub?: string }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#1e1e1e',
        color: '#d4d4d4',
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
