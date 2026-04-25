// /whiteboard/:roomId — public share-page для multiplayer-board (bible §9
// Phase 6.5.4). Идея handoff'а: кто угодно может перейти по ссылке из
// Hone «Open on web», увидеть человекочитаемое приветствие и open the
// board в desktop-app (deep-link druz9://whiteboard/<id>) или в одном
// клике скопировать room-id для join-by-id.
//
// Полноценный multiplayer Excalidraw для web — отдельная задача (нужен
// Excalidraw-bundle + Yjs + WS-binding). Пока handoff с двумя CTA.

import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

export default function WhiteboardSharePage() {
  const { roomId } = useParams<{ roomId: string }>()
  const id = useMemo(() => (roomId ?? '').trim(), [roomId])
  const [copied, setCopied] = useState(false)

  // Body bg-fix — Hone-style чёрный фон без правил рендера AppShell.
  useEffect(() => {
    const prev = document.body.style.backgroundColor
    document.body.style.backgroundColor = '#000'
    return () => {
      document.body.style.backgroundColor = prev
    }
  }, [])

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(id)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard может быть запрещён — fallback'а нет, юзер скопирует руками */
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#000',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px 24px',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <div style={{ maxWidth: 520, width: '100%', textAlign: 'center' }}>
        <div
          style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 11,
            letterSpacing: '0.24em',
            color: 'rgba(255,255,255,0.4)',
          }}
        >
          SHARED WHITEBOARD
        </div>
        <h1
          style={{
            margin: '20px 0 12px',
            fontSize: 38,
            fontWeight: 400,
            letterSpacing: '-0.025em',
            lineHeight: 1.05,
          }}
        >
          Open this board in Hone.
        </h1>
        <p
          style={{
            fontSize: 15,
            color: 'rgba(255,255,255,0.6)',
            lineHeight: 1.7,
            margin: '0 auto 32px',
            maxWidth: 420,
          }}
        >
          Multiplayer Excalidraw на web ещё в работе. А пока — открой ссылку
          в Hone (B → Join by ID) или скопируй room-id и поделись.
        </p>

        <div
          style={{
            display: 'flex',
            gap: 12,
            justifyContent: 'center',
            flexWrap: 'wrap',
            marginBottom: 32,
          }}
        >
          <a
            href={`druz9://whiteboard/${encodeURIComponent(id)}`}
            style={{
              padding: '11px 22px',
              borderRadius: 999,
              background: '#fff',
              color: '#000',
              fontSize: 13.5,
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            Open in Hone ↗
          </a>
          <button
            onClick={() => void onCopy()}
            style={{
              padding: '11px 22px',
              borderRadius: 999,
              background: 'rgba(255,255,255,0.04)',
              color: copied ? '#fff' : 'rgba(255,255,255,0.6)',
              border: '1px solid rgba(255,255,255,0.1)',
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: 11,
              letterSpacing: '0.14em',
              cursor: 'pointer',
            }}
          >
            {copied ? '✓ ROOM ID COPIED' : 'COPY ROOM ID'}
          </button>
        </div>

        <div
          style={{
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 11,
            letterSpacing: '0.08em',
            padding: '10px 14px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 8,
            color: 'rgba(255,255,255,0.5)',
            wordBreak: 'break-all',
          }}
        >
          {id}
        </div>

        <Link
          to="/hone"
          style={{
            display: 'inline-block',
            marginTop: 36,
            fontSize: 12,
            color: 'rgba(255,255,255,0.4)',
            letterSpacing: '0.14em',
            textDecoration: 'underline',
          }}
        >
          About Hone
        </Link>
      </div>
    </div>
  )
}
