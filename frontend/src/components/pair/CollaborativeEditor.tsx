// CollaborativeEditor — Monaco-based pair-coding surface for the editor
// bounded context. Wraps `@monaco-editor/react` (already in package.json,
// so we don't need a yjs install) and pipes:
//   - local edits → "op" envelopes over the editor WebSocket
//   - remote "op" snapshots → setValue (last-write-wins; backend keeps the
//     authoritative buffer per bible §3.1, this is not a true CRDT — fine
//     for MVP, swappable for yjs later)
//   - cursor moves → "cursor" envelopes (rate-limited to 8/s)
//
// Anti-fallback: if `wsStatus === 'failed'` the parent renders an
// <EmptyState variant="error" /> instead of mounting this component.
// We never fall back to a "local-only" pretend mode.

import Editor, { type OnChange, type OnMount } from '@monaco-editor/react'
import { useEffect, useRef } from 'react'
import type { EditorWsEnvelope } from '../../lib/queries/pairEditor'

type Props = {
  language: string
  value: string
  onLocalChange: (next: string) => void
  send: (env: EditorWsEnvelope) => boolean
  remote: EditorWsEnvelope | null
  readOnly?: boolean
}

export function CollaborativeEditor({
  language,
  value,
  onLocalChange,
  send,
  remote,
  readOnly,
}: Props) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const lastCursorSentAt = useRef(0)
  const applyingRemote = useRef(false)

  // Apply remote ops & snapshots — guarded with applyingRemote so the
  // resulting onChange doesn't echo back over the wire.
  useEffect(() => {
    if (!remote || !editorRef.current) return
    if (remote.kind === 'snapshot' || remote.kind === 'op') {
      const data = remote.data as { text?: string; payload?: string } | undefined
      const text = data?.text ?? (data?.payload ? safeAtob(data.payload) : null)
      if (text == null) return
      const ed = editorRef.current
      const current = ed.getValue()
      if (current === text) return
      applyingRemote.current = true
      try {
        ed.setValue(text)
      } finally {
        applyingRemote.current = false
      }
    }
  }, [remote])

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor
    editor.onDidChangeCursorPosition((ev) => {
      const now = Date.now()
      if (now - lastCursorSentAt.current < 125) return
      lastCursorSentAt.current = now
      send({
        kind: 'cursor',
        data: { line: ev.position.lineNumber, column: ev.position.column },
      })
    })
  }

  const handleChange: OnChange = (next) => {
    if (applyingRemote.current) return
    const text = next ?? ''
    onLocalChange(text)
    // MVP framing: we send the full document; backend keeps buffer +
    // distributes to other participants. Swap to OT/CRDT diffs in v2.
    send({ kind: 'op', data: { text } })
  }

  return (
    <Editor
      height="100%"
      language={language}
      value={value}
      theme="vs-dark"
      onMount={handleMount}
      onChange={handleChange}
      options={{
        readOnly: !!readOnly,
        fontFamily: 'JetBrains Mono, Menlo, monospace',
        fontSize: 13,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        renderWhitespace: 'selection',
        automaticLayout: true,
      }}
    />
  )
}

function safeAtob(s: string): string | null {
  try {
    if (typeof window !== 'undefined' && typeof window.atob === 'function') return window.atob(s)
    return null
  } catch {
    return null
  }
}
